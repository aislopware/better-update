import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";

interface BranchOption {
  readonly id: string;
  readonly name: string;
}

const PLATFORM_FILTER_LABELS: Record<string, string> = {
  all: "All platforms",
  ios: "iOS",
  android: "Android",
};

export const UpdatesFilterBar = ({
  branches,
  branchFilterLabels,
  branchFilter,
  platformFilter,
  onBranchFilter,
  onPlatformFilter,
}: {
  branches: readonly BranchOption[];
  branchFilterLabels: Record<string, string>;
  branchFilter: string | undefined;
  platformFilter: "ios" | "android" | undefined;
  onBranchFilter: (value: string | undefined) => void;
  onPlatformFilter: (value: "ios" | "android" | undefined) => void;
}) => (
  <>
    <Select
      items={PLATFORM_FILTER_LABELS}
      value={platformFilter ?? "all"}
      onValueChange={(value) => {
        if (value === "ios" || value === "android") {
          onPlatformFilter(value);
        } else {
          onPlatformFilter(undefined);
        }
      }}
    >
      <SelectTrigger className="w-36">
        <SelectValue placeholder="All platforms" />
      </SelectTrigger>
      <SelectPopup>
        <SelectGroup>
          <SelectItem value="all">All platforms</SelectItem>
          <SelectItem value="ios">iOS</SelectItem>
          <SelectItem value="android">Android</SelectItem>
        </SelectGroup>
      </SelectPopup>
    </Select>
    <Select
      items={branchFilterLabels}
      value={branchFilter ?? "all"}
      onValueChange={(value) => {
        if (value) {
          onBranchFilter(value === "all" ? undefined : value);
        }
      }}
    >
      <SelectTrigger className="w-48">
        <SelectValue placeholder="All branches" />
      </SelectTrigger>
      <SelectPopup>
        <SelectGroup>
          <SelectItem value="all">All branches</SelectItem>
          {branches.map((branch) => (
            <SelectItem key={branch.id} value={branch.id}>
              {branch.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectPopup>
    </Select>
  </>
);
