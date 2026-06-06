import React from 'react';
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AuthProvider } from "@/lib/auth";

// Pages
import Home from "@/pages/home";
import EventDetail from "@/pages/event-detail";
import Login from "@/pages/login";
import AdminEvents from "@/pages/admin/events";
import AdminEventNew from "@/pages/admin/events-new";
import AdminEventDetail from "@/pages/admin/events-detail";
import AdminMembers from "@/pages/admin/members";
import AdminUsers from "@/pages/admin/users";
import AdminSettings from "@/pages/admin/settings";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/events/:eventType/:id" component={EventDetail} />
      <Route path="/login" component={Login} />
      <Route path="/admin">
        <Redirect to="/admin/events/rotating" />
      </Route>
      <Route path="/admin/events">
        <Redirect to="/admin/events/rotating" />
      </Route>
      <Route path="/admin/events/:eventType/new" component={AdminEventNew} />
      <Route path="/admin/events/:eventType" component={AdminEvents} />
      <Route path="/admin/events/:eventType/:id" component={AdminEventDetail} />
      <Route path="/admin/members" component={AdminMembers} />
      <Route path="/admin/users" component={AdminUsers} />
      <Route path="/admin/settings" component={AdminSettings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
