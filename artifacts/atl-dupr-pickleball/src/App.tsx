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
import AdminEventsRotating from "@/pages/admin/events-rotating";
import AdminEventsFixed from "@/pages/admin/events-fixed";
import AdminEventNewRotating from "@/pages/admin/events-new-rotating";
import AdminEventNewFixed from "@/pages/admin/events-new-fixed";
import AdminEventDetailRotating from "@/pages/admin/events-detail-rotating";
import AdminEventDetailFixed from "@/pages/admin/events-detail-fixed";
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
      <Route path="/admin/events/rotating/new" component={AdminEventNewRotating} />
      <Route path="/admin/events/fixed_partner/new" component={AdminEventNewFixed} />
      <Route path="/admin/events/rotating" component={AdminEventsRotating} />
      <Route path="/admin/events/fixed_partner" component={AdminEventsFixed} />
      <Route path="/admin/events/rotating/:id" component={AdminEventDetailRotating} />
      <Route path="/admin/events/fixed_partner/:id" component={AdminEventDetailFixed} />
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
