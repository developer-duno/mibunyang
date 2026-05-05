export {};

interface KakaoShareLink {
  mobileWebUrl: string;
  webUrl: string;
}

interface KakaoShareOpts {
  objectType: "feed";
  content: { title: string; description: string; imageUrl: string; link: KakaoShareLink };
  buttons: Array<{ title: string; link: KakaoShareLink }>;
}

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    Kakao?: {
      init: (_key: string) => void;
      isInitialized: () => boolean;
      Share: {
        sendDefault: (_opts: KakaoShareOpts) => void;
      };
    };
  }
}
