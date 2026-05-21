import SubsystemUsersPage from "@/components/users/SubsystemUsersPage";

export default function PmaUsersPage() {
  return (
    <SubsystemUsersPage
      appLabel="Plan de Manejo Ambiental"
      apiPrefix="/pma"
    />
  );
}
