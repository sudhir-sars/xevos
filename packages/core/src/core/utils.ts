import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { Department, Role } from "./schema";

export function getModel(_department: Department, role: Role): LanguageModel {
  switch (role) {
    case "executive":
      return google("gemini-flash-lite-latest");

    case "head":
      return google("gemini-flash-latest");

    case "manager":

    case "worker":
      return google("gemini-flash-lite-latest");
  }
}
