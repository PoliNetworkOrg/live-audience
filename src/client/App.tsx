import { Route, Switch } from "wouter"
import { ActivityEditor } from "./admin/ActivityEditor.tsx"
import { ActivityList } from "./admin/ActivityList.tsx"
import { AdminLayout } from "./admin/AdminLayout.tsx"
import { ApiPage } from "./admin/ApiPage.tsx"
import { AudiencePage } from "./audience/AudiencePage.tsx"

export function App() {
  return (
    <Switch>
      <Route path="/admin" nest>
        <AdminLayout>
          <Switch>
            <Route path="/">
              <ActivityList />
            </Route>
            <Route path="/api">
              <ApiPage />
            </Route>
            <Route path="/activities/:id">{({ id }) => <ActivityEditor key={id} id={id} />}</Route>
          </Switch>
        </AdminLayout>
      </Route>
      <Route>
        <AudiencePage />
      </Route>
    </Switch>
  )
}
