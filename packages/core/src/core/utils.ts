import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { Department, Role } from "./schema";

export function getModel(_department: Department, role: Role): LanguageModel {
  switch (role) {
    case "executive":
      return google("gemini-3-flash-preview");

    case "head":
      return google("gemini-3-flash-preview");

    case "manager":
      return google("gemini-3-flash-preview");

    case "worker":
      return google("gemini-3-flash-preview");
  }
}
