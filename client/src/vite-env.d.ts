/// <reference types="vite/client" />

declare module '*.csv?raw' {
  const content: string;
  export default content;
}

declare interface ImportMetaEnv {
  readonly VITE_ATENXION_API_URL?: string;
  readonly VITE_ATENXION_AGENT_ID?: string;
  readonly VITE_ATENXION_API_TOKEN?: string;
}

declare interface ImportMeta {
  readonly env: ImportMetaEnv;
}
