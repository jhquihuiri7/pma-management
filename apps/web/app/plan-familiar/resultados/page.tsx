import type { Metadata } from "next";
import FamilyPlanResults from "@/components/plan-familiar/FamilyPlanResults";

export const metadata: Metadata = {
  title: "Resultados del Plan Familiar | SIGTAR",
};

export default function FamilyPlanResultsPage() {
  return <FamilyPlanResults />;
}
