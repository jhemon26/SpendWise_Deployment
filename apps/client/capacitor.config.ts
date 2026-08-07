import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.spendwise.mobile',
  appName: 'SpendWise',
  webDir: 'dist',
  // No `server.url`: the app must run entirely from the bundle so it works
  // with no network at all (ARCHITECTURE §4). A dev server URL here is the
  // classic way to accidentally ship an app that needs connectivity.
  android: { allowMixedContent: false },
  ios: { contentInset: 'always' },
};

export default config;
