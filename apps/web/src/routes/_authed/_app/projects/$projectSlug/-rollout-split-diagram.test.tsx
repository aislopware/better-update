import { render, screen } from "@testing-library/react";

import { RolloutSplitDiagram } from "./-rollout-split-diagram";

describe(RolloutSplitDiagram, () => {
  it("renders both branch labels with the split percentages", () => {
    render(
      <RolloutSplitDiagram oldBranchName="main" newBranchName="next" newBranchPercentage={30} />,
    );

    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByText("next")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
  });

  it.each([
    { input: -10, expectedNew: 0, expectedOld: 100 },
    { input: 150, expectedNew: 100, expectedOld: 0 },
    { input: Number.NaN, expectedNew: 0, expectedOld: 100 },
    { input: 33.7, expectedNew: 34, expectedOld: 66 },
  ])(
    "clamps and rounds percentage $input -> new $expectedNew%",
    ({ input, expectedNew, expectedOld }) => {
      render(
        <RolloutSplitDiagram oldBranchName="old" newBranchName="new" newBranchPercentage={input} />,
      );

      expect(screen.getByText(`${expectedOld}%`)).toBeInTheDocument();
      expect(screen.getByText(`${expectedNew}%`)).toBeInTheDocument();
    },
  );

  it("exposes an aria-label summarizing the split", () => {
    render(
      <RolloutSplitDiagram oldBranchName="main" newBranchName="next" newBranchPercentage={25} />,
    );

    expect(screen.getByLabelText("Rollout split: 75% on main, 25% on next")).toBeInTheDocument();
  });
});
