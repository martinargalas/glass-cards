// Files bundled as text (Vite's ?raw): the alarm blueprint the alarm cards install.
declare module "*.yaml?raw" {
  const text: string;
  export default text;
}
