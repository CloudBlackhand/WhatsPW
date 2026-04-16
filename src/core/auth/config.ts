import { parseBool } from '@waha/helpers';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface SValue {
  param: string;
  value: string | null;
  generated: boolean;
}

export function rand() {
  return crypto.randomUUID().toString().replace(/-/g, '');
}

function FromEnv(
  param: string,
  skip: boolean,
  adefault: string,
  search: any[],
): SValue {
  let value = process.env[param];
  const common = search.includes(value);
  if (common && !skip) {
    const human =
      value === undefined || value === null
        ? 'unset'
        : value === ''
          ? 'empty'
          : JSON.stringify(String(value));
    console.warn(
      `[WAHA Auth] ${param}=${human} is treated as insecure or placeholder; ` +
        `using an auto-generated secret instead. ` +
        `Use a strong password (not admin/123/321/waha/…) or set the matching *_NO_PASSWORD flag.`,
    );
    return {
      param: param,
      value: adefault,
      generated: true,
    };
  }

  return {
    param: param,
    value: value,
    generated: false,
  };
}

const keys = [
  '',
  null,
  undefined,
  '123',
  '321',
  'waha',
  'admin',
  '00000000000000000000000000000000',
  '11111111111111111111111111111111',
  'sha512:98b6d128682e280b74b324ca82a6bae6e8a3f7174e0605bfd52eb9948fad8984854ec08f7652f32055c4a9f12b69add4850481d9503a7f2225501671d6124648',
];

const nulls = ['', null, undefined];

interface UserPassword {
  username: SValue;
  password: SValue;
}

export class AuthConfig {
  public key: SValue;
  public keyplain: SValue;
  public dashboard: UserPassword;
  public swagger: UserPassword;

  constructor() {
    if (process.env.WHATSAPP_API_KEY) {
      process.env.WAHA_API_KEY = process.env.WHATSAPP_API_KEY;
    }
    this.key = FromEnv(
      'WAHA_API_KEY',
      parseBool(process.env.WAHA_NO_API_KEY),
      rand(),
      keys,
    );

    this.keyplain = FromEnv(
      'WAHA_API_KEY_PLAIN',
      false,
      this.key.value?.startsWith('sha512:') ? null : this.key.value,
      [],
    );

    this.dashboard = this.getDashboard();
    this.swagger = this.getSwagger();
  }

  private getDashboard(): UserPassword {
    const password = FromEnv(
      'WAHA_DASHBOARD_PASSWORD',
      parseBool(process.env.WAHA_DASHBOARD_NO_PASSWORD),
      rand(),
      keys,
    );
    const username = FromEnv(
      'WAHA_DASHBOARD_USERNAME',
      false,
      'admin',
      password.value ? nulls : [],
    );
    return {
      username: username,
      password: password,
    };
  }

  private getSwagger(): UserPassword {
    const swaggerNoPassword = parseBool(
      process.env.WHATSAPP_SWAGGER_NO_PASSWORD,
    );
    let password: SValue;
    if (swaggerNoPassword) {
      password = {
        param: 'WHATSAPP_SWAGGER_PASSWORD',
        value: null,
        generated: false,
      };
    } else if (
      process.env.WHATSAPP_SWAGGER_PASSWORD === undefined ||
      process.env.WHATSAPP_SWAGGER_PASSWORD === ''
    ) {
      // Same as dashboard; do not mark generated (avoids noisy "copy swagger" logs)
      password = {
        param: 'WHATSAPP_SWAGGER_PASSWORD',
        value: this.dashboard.password.value,
        generated: false,
      };
    } else {
      password = FromEnv(
        'WHATSAPP_SWAGGER_PASSWORD',
        false,
        this.dashboard.password.value,
        keys,
      );
    }
    const username = FromEnv(
      'WHATSAPP_SWAGGER_USERNAME',
      false,
      'admin',
      password.value ? nulls : [],
    );
    return {
      username: username,
      password: password,
    };
  }
}

export const Auth = new AuthConfig();

function generatedEnvSnapshotPath(): string {
  if (process.env.WAHA_GENERATED_ENV_FILE) {
    return path.resolve(process.cwd(), process.env.WAHA_GENERATED_ENV_FILE);
  }
  const baseDir = process.env.WAHA_LOCAL_STORE_BASE_DIR || './.sessions';
  return path.resolve(process.cwd(), baseDir, 'waha-generated.env');
}

function writeGeneratedEnvFile(lines: string[]): void {
  if (parseBool(process.env.WAHA_SKIP_GENERATED_ENV_FILE)) {
    return;
  }
  try {
    const filePath = generatedEnvSnapshotPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const body =
      '# WAHA — auto-generated credentials (do not commit). Copy to PaaS env or .env.\n' +
      `# ${new Date().toISOString()}\n` +
      `${lines.join('\n')}\n`;
    fs.writeFileSync(filePath, body, { mode: 0o600 });
    console.warn(
      `[WAHA Auth] Wrote ${lines.length} variable(s) to ${filePath} (same content as below).`,
    );
  } catch (err) {
    console.error('[WAHA Auth] Failed to write waha-generated.env:', err);
  }
}

export function ReportGeneratedValue() {
  let values = [
    Auth.key,
    Auth.dashboard.username,
    Auth.dashboard.password,
    Auth.swagger.username,
    Auth.swagger.password,
  ];
  values = values.filter((key) => key.generated);
  if (values.length === 0) {
    return;
  }
  const params = new Set(values.map((v) => v.param));
  const lines: string[] = [];
  for (const key of values) {
    if (key.value != null) {
      lines.push(`${key.param}=${key.value}`);
    }
  }
  if (
    !params.has('WHATSAPP_SWAGGER_PASSWORD') &&
    Auth.dashboard.password.generated &&
    Auth.swagger.password.value != null &&
    !parseBool(process.env.WHATSAPP_SWAGGER_NO_PASSWORD)
  ) {
    lines.push(`WHATSAPP_SWAGGER_PASSWORD=${Auth.swagger.password.value}`);
  }

  console.warn('');
  console.warn('⬇️ ⬇️ ⬇️ ⬇️ ⬇️ ⬇️ ⬇️ ⬇️ ⬇️ ⬇️ ⬇️ ⬇️');
  console.warn('Generated credentials (persist to .env or WAHA_* env vars)');
  console.warn(
    'Save these values to your environment (.env or WAHA_*) to reuse them; new keys are generated on every start otherwise.',
  );
  console.warn('');
  console.warn("cat <<'EOF' >> .env");
  console.warn('');
  for (const line of lines) {
    console.warn(line);
  }
  console.warn('EOF');
  console.warn('');
  console.warn('Generated credentials ready to copy');
  console.warn('⬆️ ⬆️ ⬆️ ⬆️ ⬆️ ⬆️ ⬆️ ⬆️ ⬆️ ⬆️ ⬆️ ⬆️');

  writeGeneratedEnvFile(lines);
}
