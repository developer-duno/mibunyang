/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FEATURE_UPCOMING?: string;
  readonly VITE_FEATURE_HOME?: string;
  readonly VITE_KAKAO_JS_KEY?: string;
  readonly VITE_KAKAO_CHANNEL_ID?: string;
  readonly DEV?: boolean;
  readonly PROD?: boolean;
}

// eslint-disable-next-line no-unused-vars
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
