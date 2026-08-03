import rc from 'rc';

const conf = rc('deepevalDashboard', {
  appUrl: '',
});

export type DashboardBackendConfig = {
  appUrl: string | undefined;
};

export function loadConfig(): DashboardBackendConfig {
  return {
    appUrl: typeof conf.appUrl === 'string' && conf.appUrl.length > 0 ? conf.appUrl : undefined,
  };
}
