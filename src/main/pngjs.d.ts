declare module "pngjs" {
  export const PNG: {
    sync: {
      write(input: {
        width: number;
        height: number;
        data: Buffer;
      }): Buffer;
    };
  };
}
