import { redirect } from "next/navigation";
export default function StatementsIndex({ params }) { redirect(`/app/${params.ws}/statements/balance-sheet`); }
