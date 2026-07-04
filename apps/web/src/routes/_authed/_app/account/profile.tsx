import {
  isAvatarContentType,
  removeUserAvatar,
  uploadUserAvatar,
} from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useRef } from "react";

import type { ChangeEvent } from "react";

import { SettingCard } from "../../../../components/setting-card";
import { SettingCardSkeleton } from "../../../../components/skeletons";
import { authClient, rejectOnAuthClientError } from "../../../../lib/auth-client";
import { EntityAvatar } from "../../../../lib/entity-avatar";
import { getFieldError, nameSchema } from "../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";
import { sessionQueryOptions } from "../../../../queries/auth";

// Mirrors the server-side cap (handlers/logo-helpers.ts MAX_LOGO_BYTES = 2 MiB);
// checked here for instant feedback before the upload round-trip.
const MAX_AVATAR_BYTES = 2_097_152;

const AvatarSection = () => {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: session } = useSuspenseQuery(sessionQueryOptions);
  const user = session?.user;

  const refreshSession = async () => {
    await queryClient.resetQueries({ queryKey: sessionQueryOptions.queryKey });
  };

  // better-auth owns the user.image column, so uploads/removals persist the URL
  // through the auth client after the server settles the stored object.
  const uploadMutation = useApiMutation({
    mutationFn: async (file: File) => {
      const imageUrl = await uploadUserAvatar(file);
      await rejectOnAuthClientError(
        authClient.updateUser({ image: imageUrl }),
        "Failed to update avatar",
      );
    },
    onSuccess: async () => {
      toastManager.add({ title: "Avatar updated", type: "success" });
      await refreshSession();
    },
  });

  const removeMutation = useApiMutation({
    mutationFn: async () => {
      await removeUserAvatar();
      await rejectOnAuthClientError(
        authClient.updateUser({ image: null }),
        "Failed to remove avatar",
      );
    },
    onSuccess: async () => {
      toastManager.add({ title: "Avatar removed", type: "success" });
      await refreshSession();
    },
  });

  const busy = uploadMutation.isPending || removeMutation.isPending;

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so re-picking the same file fires onChange again.
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!isAvatarContentType(file.type)) {
      toastManager.add({ title: "Use a PNG, JPEG, WebP, or SVG image", type: "error" });
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toastManager.add({ title: "Avatar must be 2 MB or smaller", type: "error" });
      return;
    }
    uploadMutation.mutate(file);
  };

  return (
    <SettingCard
      title="Avatar"
      description="Shown across the dashboard. PNG, JPEG, WebP, or SVG up to 2 MB."
      footer={
        <>
          {user?.image ? (
            <Button
              variant="ghost"
              disabled={busy}
              loading={removeMutation.isPending}
              onClick={() => {
                removeMutation.mutate();
              }}
            >
              Remove
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={busy}
            loading={uploadMutation.isPending}
            onClick={() => inputRef.current?.click()}
          >
            {user?.image ? "Replace avatar" : "Upload avatar"}
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-4">
        <EntityAvatar
          name={user?.name || user?.email || "U"}
          seed={user?.email || user?.name || "U"}
          image={user?.image}
          className="size-16"
        />
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          hidden
          onChange={handleFileChange}
        />
      </div>
    </SettingCard>
  );
};

const ProfileForm = () => {
  const queryClient = useQueryClient();
  const { data: session } = useSuspenseQuery(sessionQueryOptions);

  const updateProfileMutation = useApiMutation({
    mutationFn: async (input: { name: string }) =>
      rejectOnAuthClientError(authClient.updateUser(input), "Failed to update profile"),
    onSuccess: async () => {
      toastManager.add({ title: "Profile updated", type: "success" });
      await queryClient.resetQueries({ queryKey: sessionQueryOptions.queryKey });
    },
  });

  const form = useForm({
    defaultValues: {
      // eslint-disable-next-line eslint-js/no-restricted-syntax -- controlled input requires string
      name: session?.user.name ?? "",
    },
    onSubmit: async ({ value }) => {
      await safeSubmit(updateProfileMutation.mutateAsync(value));
    },
  });

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
      }}
    >
      <SettingCard
        title="Profile"
        description="This is how others will see you across the workspace."
        footer={
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <Button type="submit" disabled={!canSubmit} loading={Boolean(isSubmitting)}>
                Save changes
              </Button>
            )}
          </form.Subscribe>
        }
      >
        <form.Field
          name="name"
          validators={{
            onBlur: ({ value }) => {
              const result = nameSchema.safeParse(value);
              return result.success ? undefined : result.error.issues[0]?.message;
            },
          }}
        >
          {(field) => {
            const errorMessage = getFieldError(field);
            return (
              <Field invalid={Boolean(errorMessage)}>
                <FieldLabel htmlFor="profile-name">Name</FieldLabel>
                <Input
                  id="profile-name"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                />
                <FieldError match={Boolean(errorMessage)}>{errorMessage}</FieldError>
              </Field>
            );
          }}
        </form.Field>
        <Field>
          <FieldLabel>Email</FieldLabel>
          <Input
            // eslint-disable-next-line eslint-js/no-restricted-syntax -- session.user is non-null on /account/* routes; controlled input requires string
            value={session?.user.email ?? ""}
            disabled
          />
          <p className="text-muted-foreground text-xs">
            Tied to your sign-in identity. Contact support to change it.
          </p>
        </Field>
      </SettingCard>
    </form>
  );
};

const ProfilePage = () => (
  <div className="flex w-full flex-col gap-6">
    <AvatarSection />
    <ProfileForm />
  </div>
);

const ProfilePagePending = () => (
  <div className="flex w-full flex-col gap-6">
    <SettingCardSkeleton fields={1} />
    <SettingCardSkeleton fields={2} />
  </div>
);

export const Route = createFileRoute("/_authed/_app/account/profile")({
  beforeLoad: async ({ context }) => {
    await context.queryClient.ensureQueryData(sessionQueryOptions);
  },
  pendingComponent: ProfilePagePending,
  pendingMs: 0,
  pendingMinMs: 0,
  component: ProfilePage,
});
