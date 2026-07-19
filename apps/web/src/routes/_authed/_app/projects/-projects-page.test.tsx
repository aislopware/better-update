import { render, screen } from "@testing-library/react";
import { subDays, subHours } from "date-fns";

import { makeProject } from "../../../../../tests/helpers/fixtures";
import { ActivityCell, StructureCell, activityTone } from "./index";

describe(activityTone, () => {
  it("is success within 7 days", () => {
    expect(activityTone(subHours(new Date(), 5).toISOString())).toBe("success");
  });

  it("is undefined between 7 and 30 days", () => {
    expect(activityTone(subDays(new Date(), 14).toISOString())).toBeUndefined();
  });

  it("is muted beyond 30 days", () => {
    expect(activityTone(subDays(new Date(), 45).toISOString())).toBe("muted");
  });
});

describe(ActivityCell, () => {
  it("shows a success dot with the relative time for recently active projects", () => {
    const { container } = render(
      <ActivityCell
        project={makeProject({ lastActivityAt: subHours(new Date(), 5).toISOString() })}
      />,
    );
    expect(container.querySelector('[class*="bg-success"]')).not.toBeNull();
    expect(screen.getByText("5 hours ago")).toBeInTheDocument();
  });

  it("shows a muted dot for projects stale beyond 30 days", () => {
    const { container } = render(
      <ActivityCell
        project={makeProject({ lastActivityAt: subDays(new Date(), 45).toISOString() })}
      />,
    );
    expect(container.querySelector('[class*="bg-muted-foreground"]')).not.toBeNull();
    expect(container.querySelector('[class*="bg-success"]')).toBeNull();
  });

  it("renders plain relative time in the unremarkable middle band", () => {
    const { container } = render(
      <ActivityCell
        project={makeProject({ lastActivityAt: subDays(new Date(), 14).toISOString() })}
      />,
    );
    // No StatusDot at all — the dot spans are the only rounded-full elements.
    expect(container.querySelector('[class*="rounded-full"]')).toBeNull();
    expect(screen.getByText("14 days ago")).toBeInTheDocument();
  });

  it("keeps the archived badge for archived projects", () => {
    render(
      <ActivityCell
        project={makeProject({
          lastActivityAt: subDays(new Date(), 2).toISOString(),
          archivedAt: subDays(new Date(), 1).toISOString(),
        })}
      />,
    );
    expect(screen.getByText(/Archived/u)).toBeInTheDocument();
  });
});

describe(StructureCell, () => {
  it("renders combined branch and channel counts", () => {
    const { container } = render(
      <StructureCell project={makeProject({ branchCount: 5, channelCount: 1 })} />,
    );
    expect(container.textContent).toBe("5 branches · 1 channel");
  });

  it("singularizes branch and pluralizes channels", () => {
    const { container } = render(
      <StructureCell project={makeProject({ branchCount: 1, channelCount: 4 })} />,
    );
    expect(container.textContent).toBe("1 branch · 4 channels");
  });
});
