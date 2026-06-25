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

export const codingTools = (sandbox: DockerSandbox) =>
  [
    bash(sandbox),
    readFile(sandbox),
    writeFile(sandbox),
    editFile(sandbox),
    multiEdit(sandbox),
    insert(sandbox),
    listDir(sandbox),
    glob(sandbox),
    grep(sandbox),
  ] as const;
