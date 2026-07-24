// Override express-serve-static-core ParamsDictionary to narrow to string only.
// At runtime, route params are always strings; the v5 types over-broadened this.
import "express-serve-static-core";

declare module "express-serve-static-core" {
  export interface ParamsDictionary {
    [key: string]: string;
  }
}
