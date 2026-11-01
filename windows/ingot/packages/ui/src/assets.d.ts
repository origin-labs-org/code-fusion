declare module "*.css";
declare module "*.mp3";
declare module "*.png";
declare module "*.svg";
declare module "*.webp";

declare module "*?url" {
  const src: string;
  export default src;
}
