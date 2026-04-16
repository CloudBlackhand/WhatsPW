import {
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AppsService,
  IAppsService,
} from '@waha/apps/app_sdk/services/IAppsService';
import { EngineBootstrap } from '@waha/core/abc/EngineBootstrap';
import { GowsEngineConfigService } from '@waha/core/config/GowsEngineConfigService';
import { WPPEngineConfigService } from '@waha/core/config/WPPEngineConfigService';
import { WebJSEngineConfigService } from '@waha/core/config/WebJSEngineConfigService';
import { WhatsappSessionGoWSCore } from '@waha/core/engines/gows/session.gows.core';
import { WebhookConductor } from '@waha/core/integrations/webhooks/WebhookConductor';
import { MediaStorageFactory } from '@waha/core/media/MediaStorageFactory';
import { DefaultMap } from '@waha/utils/DefaultMap';
import { getPinoLogLevel, LoggerBuilder } from '@waha/utils/logging';
import { promiseTimeout, sleep } from '@waha/utils/promiseTimeout';
import { complete } from '@waha/utils/reactive/complete';
import { SwitchObservable } from '@waha/utils/reactive/SwitchObservable';
import { PinoLogger } from 'nestjs-pino';
import { EMPTY, Observable, retry, share } from 'rxjs';
import { map } from 'rxjs/operators';

import { getNamespace, getSessionNamespace } from '../config';
import { WhatsappConfigService } from '../config.service';
import {
  WAHAEngine,
  WAHAEvents,
  WAHASessionStatus,
} from '../structures/enums.dto';
import {
  ProxyConfig,
  SessionConfig,
  SessionDetailedInfo,
  SessionDTO,
  SessionInfo,
} from '../structures/sessions.dto';
import { WebhookConfig } from '../structures/webhooks.config.dto';
import { populateSessionInfo, SessionManager } from './abc/manager.abc';
import { SessionParams, WhatsappSession } from './abc/session.abc';
import { EngineConfigService } from './config/EngineConfigService';
import { WhatsappSessionNoWebCore } from './engines/noweb/session.noweb.core';
import { WhatsappSessionWPPCore } from './engines/wpp/session.wpp.core';
import { WhatsappSessionWebJSCore } from './engines/webjs/session.webjs.core';
import { getProxyConfig } from './helpers.proxy';
import { MediaManager } from './media/MediaManager';
import { LocalSessionAuthRepository } from './storage/LocalSessionAuthRepository';
import { LocalStoreCore } from './storage/LocalStoreCore';
import { CoreApiKeyRepository } from './storage/CoreApiKeyRepository';

type SessionRecord = {
  instance: WhatsappSession | null;
  config?: SessionConfig;
};

@Injectable()
export class SessionManagerCore extends SessionManager implements OnModuleInit {
  SESSION_STOP_TIMEOUT = 3000;

  /** Session name → record (instance null = stopped). */
  private readonly sessionRecords = new Map<string, SessionRecord>();

  /** Per-session event streams for WebSocket / consumers. */
  private readonly eventsBySession = new Map<
    string,
    DefaultMap<WAHAEvents, SwitchObservable<any>>
  >();

  protected readonly EngineClass: typeof WhatsappSession;
  protected readonly engineBootstrap: EngineBootstrap;

  constructor(
    config: WhatsappConfigService,
    private engineConfigService: EngineConfigService,
    private webjsEngineConfigService: WebJSEngineConfigService,
    private wppEngineConfigService: WPPEngineConfigService,
    gowsConfigService: GowsEngineConfigService,
    log: PinoLogger,
    private mediaStorageFactory: MediaStorageFactory,
    @Inject(AppsService)
    appsService: IAppsService,
  ) {
    super(log, config, gowsConfigService, appsService);
    const engineName = this.engineConfigService.getDefaultEngineName();
    this.EngineClass = this.getEngine(engineName);
    this.engineBootstrap = this.getEngineBootstrap(engineName);

    this.store = new LocalStoreCore(getNamespace(), getSessionNamespace());
    this.sessionAuthRepository = new LocalSessionAuthRepository(this.store);
    this.sessionRecords.set('default', { instance: null });
    this.clearStorage().catch((error) => {
      this.log.error({ error }, 'Error while clearing storage');
    });
  }

  private ensureEventsMap(
    name: string,
  ): DefaultMap<WAHAEvents, SwitchObservable<any>> {
    if (!this.eventsBySession.has(name)) {
      this.eventsBySession.set(
        name,
        new DefaultMap<WAHAEvents, SwitchObservable<any>>(
          (key) =>
            new SwitchObservable((obs$) => {
              return obs$.pipe(retry(), share());
            }),
        ),
      );
    }
    return this.eventsBySession.get(name);
  }

  private releaseSessionEvents(name: string) {
    const eventsMap = this.eventsBySession.get(name);
    if (eventsMap) {
      complete(eventsMap);
      this.eventsBySession.delete(name);
    }
  }

  protected getEngine(engine: WAHAEngine): typeof WhatsappSession {
    if (engine === WAHAEngine.WEBJS) {
      return WhatsappSessionWebJSCore;
    } else if (engine === WAHAEngine.WPP) {
      return WhatsappSessionWPPCore;
    } else if (engine === WAHAEngine.NOWEB) {
      return WhatsappSessionNoWebCore;
    } else if (engine === WAHAEngine.GOWS) {
      return WhatsappSessionGoWSCore;
    } else {
      throw new NotFoundException(`Unknown whatsapp engine '${engine}'.`);
    }
  }

  async beforeApplicationShutdown(signal?: string) {
    for (const name of [...this.sessionRecords.keys()]) {
      if (this.isRunning(name)) {
        await this.stop(name, true);
      }
    }
    this.stopEvents();
    await this.engineBootstrap.shutdown();
  }

  async onApplicationBootstrap() {
    this.apiKeyRepository = new CoreApiKeyRepository();
    await this.engineBootstrap.bootstrap();
    this.startPredefinedSessions();
  }

  protected startPredefinedSessions() {
    const startSessions = this.config.startSessions;
    startSessions.forEach((sessionName) => {
      this.withLock(sessionName, async () => {
        if (!this.sessionRecords.has(sessionName)) {
          this.sessionRecords.set(sessionName, { instance: null });
        }
        const log = this.log.logger.child({ session: sessionName });
        log.info(`Restarting PREDEFINED session...`);
        await this.start(sessionName).catch((error) => {
          log.error(`Failed to start PREDEFINED session: ${error}`);
          log.error(error.stack);
        });
      });
    });
  }

  private async clearStorage() {
    const storage = await this.mediaStorageFactory.build(
      'all',
      this.log.logger.child({ name: 'Storage' }),
    );
    await storage.purge();
  }

  //
  // API Methods
  //
  async exists(name: string): Promise<boolean> {
    return this.sessionRecords.has(name);
  }

  isRunning(name: string): boolean {
    return !!this.sessionRecords.get(name)?.instance;
  }

  async upsert(name: string, config?: SessionConfig): Promise<void> {
    const prev = this.sessionRecords.get(name);
    this.sessionRecords.set(name, {
      instance: prev?.instance ?? null,
      config,
    });
  }

  async start(name: string): Promise<SessionDTO> {
    const rec = this.sessionRecords.get(name);
    if (!rec) {
      throw new NotFoundException(
        `We didn't find a session with name '${name}'.\n` +
          `Create it first with POST /api/sessions`,
      );
    }
    if (rec.instance) {
      throw new UnprocessableEntityException(
        `Session '${name}' is already started.`,
      );
    }
    this.log.info({ session: name }, `Starting session...`);
    const logger = this.log.logger.child({ session: name });
    logger.level = getPinoLogLevel(rec.config?.debug);
    const loggerBuilder: LoggerBuilder = logger;

    const storage = await this.mediaStorageFactory.build(
      name,
      loggerBuilder.child({ name: 'Storage' }),
    );
    await storage.init();
    const mediaManager = new MediaManager(
      storage,
      this.config.mimetypes,
      loggerBuilder.child({ name: 'MediaManager' }),
    );

    const webhook = new WebhookConductor(loggerBuilder);
    const proxyConfig = this.getProxyConfig(name);
    const sessionConfig: SessionParams = {
      name,
      mediaManager,
      loggerBuilder,
      printQR: this.engineConfigService.shouldPrintQR,
      sessionStore: this.store,
      proxyConfig: proxyConfig,
      sessionConfig: rec.config,
      ignore: this.ignoreChatsConfig(rec.config),
    };
    if (this.EngineClass === WhatsappSessionWebJSCore) {
      sessionConfig.engineConfig = this.webjsEngineConfigService.getConfig();
    } else if (this.EngineClass === WhatsappSessionWPPCore) {
      sessionConfig.engineConfig = this.wppEngineConfigService.getConfig();
    } else if (this.EngineClass === WhatsappSessionGoWSCore) {
      sessionConfig.engineConfig = this.gowsConfigService.getConfig();
    }
    await this.sessionAuthRepository.init(name);
    // @ts-ignore
    const session = new this.EngineClass(sessionConfig);
    rec.instance = session;
    this.updateSession(name);

    const webhooks = this.getWebhooks(rec.config);
    webhook.configure(session, webhooks);

    try {
      await this.appsService.beforeSessionStart(session, this.store);
    } catch (e) {
      logger.error(`Apps Error: ${e}`);
      session.status = WAHASessionStatus.FAILED;
    }

    if (session.status !== WAHASessionStatus.FAILED) {
      await session.start();
      logger.info('Session has been started.');
      await this.appsService.afterSessionStart(session, this.store);
    }

    await this.appsService.afterSessionStart(session, this.store);

    return {
      name: session.name,
      status: session.status,
      config: session.sessionConfig,
    };
  }

  private updateSession(name: string) {
    const rec = this.sessionRecords.get(name);
    const inst = rec?.instance;
    if (!inst) {
      this.releaseSessionEvents(name);
      return;
    }
    const events2 = this.ensureEventsMap(name);
    for (const eventName in WAHAEvents) {
      const event = WAHAEvents[eventName];
      const stream$ = inst
        .getEventObservable(event)
        .pipe(map(populateSessionInfo(event, inst)));
      events2.get(event).switch(stream$);
    }
  }

  getSessionEvent(session: string, event: WAHAEvents): Observable<any> {
    const events2 = this.eventsBySession.get(session);
    if (!events2) {
      return EMPTY;
    }
    return events2.get(event);
  }

  async stop(name: string, silent: boolean): Promise<void> {
    if (!this.isRunning(name)) {
      this.log.debug({ session: name }, `Session is not running.`);
      return;
    }

    this.log.info({ session: name }, `Stopping session...`);
    try {
      const session = this.getSession(name);
      await session.stop();
    } catch (err) {
      this.log.warn(`Error while stopping session '${name}'`);
      if (!silent) {
        throw err;
      }
    }
    this.log.info({ session: name }, `Session has been stopped.`);
    const rec = this.sessionRecords.get(name);
    if (rec) {
      rec.instance = null;
    }
    this.updateSession(name);
    await sleep(this.SESSION_STOP_TIMEOUT);
  }

  async unpair(name: string) {
    const rec = this.sessionRecords.get(name);
    const session = rec?.instance;
    if (!session) {
      return;
    }

    this.log.info({ session: name }, 'Unpairing the device from account...');
    await session.unpair().catch((err) => {
      this.log.warn(`Error while unpairing from device: ${err}`);
    });
    await sleep(1000);
  }

  async logout(name: string): Promise<void> {
    await this.sessionAuthRepository.clean(name);
  }

  async delete(name: string): Promise<void> {
    await this.appsService.removeBySession(this, name);
    this.sessionRecords.delete(name);
    this.releaseSessionEvents(name);
  }

  private getWebhooks(sessionCfg?: SessionConfig) {
    let webhooks: WebhookConfig[] = [];
    if (sessionCfg?.webhooks) {
      webhooks = webhooks.concat(sessionCfg.webhooks);
    }
    const globalWebhookConfig = this.config.getWebhookConfig();
    if (globalWebhookConfig) {
      webhooks.push(globalWebhookConfig);
    }
    return webhooks;
  }

  private runningSessionsRecord(): Record<string, WhatsappSession> {
    const out: Record<string, WhatsappSession> = {};
    for (const [n, rec] of this.sessionRecords) {
      if (rec.instance) {
        out[n] = rec.instance;
      }
    }
    return out;
  }

  protected getProxyConfig(
    sessionName: string,
  ): ProxyConfig | undefined {
    const rec = this.sessionRecords.get(sessionName);
    if (rec?.config?.proxy) {
      return rec.config.proxy;
    }
    const sessions = this.runningSessionsRecord();
    return getProxyConfig(this.config, sessions, sessionName);
  }

  getSession(name: string): WhatsappSession {
    const session = this.sessionRecords.get(name)?.instance;
    if (!session) {
      throw new NotFoundException(
        `We didn't find a session with name '${name}'.\n` +
          `Please start it first by using POST /api/sessions/${name}/start request`,
      );
    }
    return session;
  }

  async getSessions(all: boolean): Promise<SessionInfo[]> {
    const out: SessionInfo[] = [];
    for (const [name, rec] of this.sessionRecords) {
      if (rec.instance) {
        const session = rec.instance;
        const me = session.getSessionMeInfo();
        out.push({
          name: session.name,
          status: session.status,
          config: session.sessionConfig,
          me: me,
          presence: session.presence,
          timestamps: {
            activity: session.getLastActivityTimestamp(),
          },
        });
      } else if (all) {
        out.push({
          name,
          status: WAHASessionStatus.STOPPED,
          config: rec.config,
          me: null,
          presence: null,
          timestamps: {
            activity: null,
          },
        });
      }
    }
    return out;
  }

  private async fetchEngineInfo(session: WhatsappSession | null) {
    let engineInfo = {};
    if (session) {
      try {
        engineInfo = await promiseTimeout(1000, session.getEngineInfo());
      } catch (error) {
        this.log.debug(
          { session: session.name, error: `${error}` },
          'Can not get engine info',
        );
      }
    }
    return {
      engine: session?.engine ?? this.engineConfigService.getDefaultEngineName(),
      ...engineInfo,
    };
  }

  async getSessionInfo(name: string): Promise<SessionDetailedInfo | null> {
    if (!this.sessionRecords.has(name)) {
      return null;
    }
    const rec = this.sessionRecords.get(name);
    if (!rec.instance) {
      return {
        name,
        status: WAHASessionStatus.STOPPED,
        config: rec.config,
        me: null,
        presence: null,
        timestamps: {
          activity: null,
        },
        engine: await this.fetchEngineInfo(null),
      };
    }
    const session = rec.instance;
    const me = session.getSessionMeInfo();
    const engine = await this.fetchEngineInfo(session);
    return {
      name: session.name,
      status: session.status,
      config: session.sessionConfig,
      me: me,
      presence: session.presence,
      timestamps: {
        activity: session.getLastActivityTimestamp(),
      },
      engine,
    };
  }

  protected stopEvents() {
    for (const eventsMap of this.eventsBySession.values()) {
      complete(eventsMap);
    }
    this.eventsBySession.clear();
  }

  async onModuleInit() {
    await this.init();
  }

  async init() {
    await this.store.init();
    const knex = this.store.getWAHADatabase();
    await this.appsService.migrate(knex);
  }
}
