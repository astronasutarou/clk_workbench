import blink from "./blink.src?raw";
import composite from "./composite.src?raw";
import event from "./event.src?raw";
import multibit from "./multibit.src?raw";
import subroutine from "./subroutine.src?raw";

export const EXAMPLES = [
  { name: "blink.src", source: blink },
  { name: "multibit.src", source: multibit },
  { name: "event.src", source: event },
  { name: "subroutine.src", source: subroutine },
  { name: "composite.src", source: composite },
] as const;
