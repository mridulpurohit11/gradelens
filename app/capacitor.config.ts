import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Change appId to your own reverse-domain id before publishing (it cannot change after release).
  appId: 'com.gradelens.faculty',
  appName: 'GradeLens',
  webDir: 'dist',
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 800, backgroundColor: '#F7F8FA', showSpinner: false },
    StatusBar: { style: 'LIGHT', backgroundColor: '#FFFFFF' },
  },
};

export default config;
