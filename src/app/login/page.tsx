import { AuthCard } from "@/components/auth-card";
import { loginAction } from "../actions";
export default function Page() { return <AuthCard mode="login" action={loginAction} />; }
