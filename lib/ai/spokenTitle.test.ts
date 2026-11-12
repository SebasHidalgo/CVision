import { describe, expect, it } from "vitest";
import { spokenTitle } from "./spokenTitle";

describe("spokenTitle", () => {
  it.each([
    ["Desarrollador/a Backend Senior", "Desarrollador Backend Senior"],
    ["Ingeniero(a) de Software", "Ingeniero de Software"],
    ["Analista de datos (m/f)", "Analista de datos"],
    ["Software Engineer (m/f/d)", "Software Engineer"],
    ["Entwickler/in Backend [m/w/d]", "Entwickler Backend"],
    ["Abogada/o laboral", "Abogada laboral"],
    ["Desarrolladores/as web", "Desarrolladores web"],
    ["Director/Directora de Operaciones", "Director de Operaciones"],
    ["Jefe/Jefa de turno", "Jefe de turno"],
    ["DESARROLLADOR/A FULL STACK", "DESARROLLADOR FULL STACK"],
    ["Vendedor(es) de mostrador", "Vendedor de mostrador"],
  ])("says %s as %s", (written, spoken) => {
    expect(spokenTitle(written)).toBe(spoken);
  });

  it.each([
    "Frontend Engineer",
    "UI/UX Designer",
    "Frontend/Backend Developer",
    "QA/QC Analyst",
    "Data/Database Engineer",
    "DevOps Engineer (AWS)",
    "Account Executive (Remote)",
    "C/C++ Developer",
    "Analista de Datos",
  ])("leaves %s as written", (title) => {
    expect(spokenTitle(title)).toBe(title);
  });

  it.each([
    ["Programador SR", "Programador Senior"],
    ["Sr. Software Engineer", "Senior Software Engineer"],
    ["Analista Sr Contable", "Analista Senior Contable"],
    ["Desarrollador JR", "Desarrollador Junior"],
    ["Jr. Data Analyst", "Junior Data Analyst"],
    ["Desarrollador .NET SSR", "Desarrollador .NET Semi Senior"],
    ["Analista Ssr.", "Analista Semi Senior"],
    ["Diseñador Semi-Sr", "Diseñador Semi Senior"],
    ["Desarrollador/a SR (m/f)", "Desarrollador Senior"],
  ])("says the seniority in %s in full", (written, spoken) => {
    expect(spokenTitle(written)).toBe(spoken);
  });

  it.each(["Srinivasan Labs Engineer", "Jrnl Editor", "QA Analyst SQL", "Ingeniero de Datos AWS", "Ssrs Report Developer"])("leaves %s alone", (title) => {
    expect(spokenTitle(title)).toBe(title);
  });

  it("never answers with nothing", () => {
    expect(spokenTitle("(m/f)")).toBe("(m/f)");
    expect(spokenTitle("  Product   Manager ")).toBe("Product Manager");
  });
});
