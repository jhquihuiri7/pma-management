import type { Metadata } from "next";
import FamilyPlanForm from "@/components/plan-familiar/FamilyPlanForm";
import "./plan-familiar.css";

export const metadata: Metadata = {
  title: "Plan Familiar de Emergencia | SIGTAR",
  description: "Formulario público para preparar y registrar el plan familiar de emergencia.",
};

export default function FamilyPlanPage() {
  return <FamilyPlanForm />;
}
