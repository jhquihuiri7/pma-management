import type { Metadata } from "next";
import FamilyPlanResults from "@/components/plan-familiar/FamilyPlanResults";
import "../plan-familiar.css";

export const metadata: Metadata = {
  title: "Resultados del Plan Familiar | SIGTAR",
};

export default function FamilyPlanResultsPage() {
  return <FamilyPlanResults />;
}
