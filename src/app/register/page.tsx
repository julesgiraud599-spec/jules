import { AuthCard } from "@/components/auth-card";
import { registerAction } from "../actions";
export default function Page() { return <AuthCard mode="register" action={registerAction} />; }
