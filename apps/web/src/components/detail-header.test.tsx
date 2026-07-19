import { Link } from "@tanstack/react-router";
import { screen } from "@testing-library/react";
import { PackageXIcon } from "lucide-react";

import { renderWithQuery } from "../../tests/helpers/render-with-query";
import { DetailHeader, DetailNotFound } from "./detail-header";

describe(DetailHeader, () => {
  it("renders the title with badges, meta, and actions slots", () => {
    renderWithQuery(
      <DetailHeader
        title="production"
        badges={<span>Built-in</span>}
        meta={<span>chan_123</span>}
        actions={<button type="button">Pause</button>}
      />,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("production");
    expect(screen.getByText("Built-in")).toBeInTheDocument();
    expect(screen.getByText("chan_123")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("exposes a hover tooltip for string titles", () => {
    renderWithQuery(<DetailHeader title="a-very-long-channel-name" />);
    expect(screen.getByText("a-very-long-channel-name")).toHaveAttribute(
      "title",
      "a-very-long-channel-name",
    );
  });

  it("omits the meta and actions rows when not provided", () => {
    renderWithQuery(<DetailHeader title="Fingerprint" />);
    const header = screen.getByRole("banner");
    expect(header.querySelectorAll(":scope > div")).toHaveLength(1);
  });
});

describe(DetailNotFound, () => {
  it("renders the empty state with a back link action", () => {
    renderWithQuery(
      <DetailNotFound
        icon={<PackageXIcon />}
        title="Build not found in this project"
        description="The requested build exists outside this project or was removed."
        backLink={<Link to="/" />}
        backLabel="Back to project"
      />,
    );

    expect(screen.getByText("Build not found in this project")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to project" })).toBeInTheDocument();
  });

  it("omits the action row without a back link", () => {
    renderWithQuery(
      <DetailNotFound
        icon={<PackageXIcon />}
        title="No builds or updates yet"
        description="Nothing references this fingerprint."
      />,
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
