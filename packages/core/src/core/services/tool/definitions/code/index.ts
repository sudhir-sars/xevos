import { bash } from "./bash";
import { readFile } from "./read-file";
import { writeFile } from "./write-file";
import { editFile } from "./edit-file";
import { multiEdit } from "./multi-edit";
import { insert } from "./insert";
import { listDir } from "./list-dir";
import { glob } from "./glob";
import { grep } from "./grep";

import { DockerSandbox } from "../../../../sandbox";

// Coding tools execute directly against the sandbox. Mark them `direct` so the
// tool layer emits an observation event per call — the transparency the
// non-coding trivial tools already get.
const markDirect = <D>(d: D): D & { direct: true } =>
  ({ ...d, direct: true }) as D & { direct: true };

export const codingTools = (sandbox: DockerSandbox) =>
  [
    markDirect(bash(sandbox)),
    markDirect(readFile(sandbox)),
    markDirect(writeFile(sandbox)),
    markDirect(editFile(sandbox)),
    markDirect(multiEdit(sandbox)),
    markDirect(insert(sandbox)),
    markDirect(listDir(sandbox)),
    markDirect(glob(sandbox)),
    markDirect(grep(sandbox)),
  ] as const;
