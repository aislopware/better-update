import { shouldRunExpoDoctor } from "./build-workflow";

describe(shouldRunExpoDoctor, () => {
  it("runs by default", () => {
    expect(shouldRunExpoDoctor({ doctor: undefined, env: {} })).toBe(true);
    expect(shouldRunExpoDoctor({ doctor: true, env: {} })).toBe(true);
  });

  it("is skipped by --no-doctor", () => {
    expect(shouldRunExpoDoctor({ doctor: false, env: {} })).toBe(false);
  });

  it("is skipped by the better-update or the EAS env switch", () => {
    expect(
      shouldRunExpoDoctor({
        doctor: undefined,
        env: { BETTER_UPDATE_BUILD_DISABLE_EXPO_DOCTOR_STEP: "1" },
      }),
    ).toBe(false);
    expect(
      shouldRunExpoDoctor({
        doctor: undefined,
        env: { EAS_BUILD_DISABLE_EXPO_DOCTOR_STEP: "true" },
      }),
    ).toBe(false);
  });

  it("treats an empty, 0 or false switch as unset", () => {
    expect(
      ["", "0", "false", "FALSE"].map((value) =>
        shouldRunExpoDoctor({
          doctor: undefined,
          env: { BETTER_UPDATE_BUILD_DISABLE_EXPO_DOCTOR_STEP: value },
        }),
      ),
    ).toStrictEqual([true, true, true, true]);
  });
});
