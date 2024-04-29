
export type ThemeType = {
  [key in ThemeColors]: string;
};

export enum ThemeColors {
  DARK = "dark",
  LIGHT = "light"
};

export enum Languages {
  EN = "en",
  HE = "he"
};