import { useState } from "react";
import { useLocation } from "wouter";
import { useLogin, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { USER_ROLE_IDS } from "@/lib/user-roles";

export default function Login() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { setAuthToken } = useAuth();
  const login = useLogin();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    login.mutate(
      { data: { username, password } },
      {
        onSuccess: (user) => {
          // @ts-ignore — token is added server-side for dev
          const token = user.token as string | undefined;
          if (token) {
            localStorage.setItem("authToken", token);
            setAuthToken(token);
          }
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          if (user.role === USER_ROLE_IDS.event_participant) {
            setLocation("/");
          } else {
            setLocation("/admin/events");
          }
        },
        onError: (err: any) => {
          const status = err?.status;
          const msg = err?.data?.error || err?.message || "Invalid username or password.";
          if (status === 429) {
            const minutes = err?.data?.retryAfterMs ? Math.ceil(err.data.retryAfterMs / 60000) : 15;
            toast({ title: "Too many attempts", description: `Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, variant: "destructive" });
          } else {
            toast({ title: "Login failed", description: msg, variant: "destructive" });
          }
        },
      }
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-4">
            <span className="w-1.5 h-8 bg-primary rounded-sm inline-block" />
            <span className="font-bold tracking-wide uppercase text-foreground">Atlanta DUPR Pickleball</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Admin Sign In</h1>
          <p className="text-muted-foreground text-sm mt-1">Enter your credentials to access the panel</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-card border border-card-border rounded-lg p-6 shadow-md space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              data-testid="input-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              required
              autoComplete="username"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              data-testid="input-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>
          <Button
            data-testid="button-submit"
            type="submit"
            className="w-full"
            disabled={login.isPending}
          >
            {login.isPending ? "Signing in..." : "Sign In"}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-4">
          <a href="/" className="hover:underline text-primary">Back to public site</a>
        </p>
      </div>
    </div>
  );
}
