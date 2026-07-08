import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@better-update/ui/components/ui/breadcrumb";
import { Button } from "@better-update/ui/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { Link } from "@tanstack/react-router";

import { AndroidIcon } from "../../../../../components/android-icon";

export const AndroidDetailHeader = ({
  projectSlug,
  packageName,
}: {
  projectSlug: string;
  packageName: string;
}) => (
  <div className="flex flex-col gap-4">
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink
            render={
              <Link
                to="/projects/$projectSlug/credentials"
                params={{ projectSlug }}
                className="text-muted-foreground hover:text-foreground"
              />
            }
          >
            Credentials
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage className="font-mono">{packageName}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5">
          <AndroidIcon className="size-5" />
          <span className="font-mono">{packageName}</span>
        </CardTitle>
        <CardDescription>Application Identifier</CardDescription>
      </CardHeader>
    </Card>
  </div>
);

export const AndroidNotFoundEmpty = ({
  projectSlug,
  packageName,
}: {
  projectSlug: string;
  packageName: string;
}) => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <AndroidIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>Application identifier not found</EmptyTitle>
        <EmptyDescription>
          No identifier exists for <code className="text-foreground font-mono">{packageName}</code>{" "}
          on this project.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          variant="outline"
          render={<Link to="/projects/$projectSlug/credentials" params={{ projectSlug }} />}
        >
          Back to credentials
        </Button>
      </EmptyContent>
    </Empty>
  </Card>
);
