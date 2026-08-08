import {
  isAvatarContentType,
  removeUserAvatar,
  uploadUserAvatar,
} from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/button";
import { Input } from "@better-update/ui/components/input";
import { toast } from "@better-update/ui/components/toast";
import { useForm } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useRef } from "react";

import type { ChangeEvent } from "react";

import { PageHeader } from "../../../../components/page-header";
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
      toast.success("Avatar updated");
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
      toast.success("Avatar removed");
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
      toast.error("Use a PNG, JPEG, WebP, or SVG image");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error("Avatar must be 2 MB or smaller");
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
              onClick={() => {
                removeMutation.mutate();
              }}
              loading={removeMutation.isPending}
            >
              Remove
            </Button>
          ) : null}
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            loading={uploadMutation.isPending}
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
      toast.success("Profile updated");
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
      {/* Not "Profile" — that is the page, and a card repeating its page's own
          name reads as the header having been written twice. */}
      <SettingCard
        title="Name and email"
        description="This is how others will see you across the workspace."
        footer={
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <Button
                variant="primary"
                type="submit"
                disabled={!canSubmit || Boolean(isSubmitting)}
                loading={Boolean(isSubmitting)}
              >
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
              <Input
                label="Name"
                error={errorMessage}
                id="profile-name"
                value={field.state.value}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                }}
                onBlur={field.handleBlur}
              />
            );
          }}
        </form.Field>
        <Input
          label="Email"
          description="Tied to your sign-in identity. Contact support to change it."
          // eslint-disable-next-line eslint-js/no-restricted-syntax -- session.user is non-null on /account/* routes; controlled input requires string
          value={session?.user.email ?? ""}
          disabled
        />
      </SettingCard>
    </form>
  );
};

const ProfilePage = () => (
  <>
    <PageHeader title="Profile" />
    <AvatarSection />
    <ProfileForm />
  </>
);

const ProfilePagePending = () => (
  <>
    <PageHeader title="Profile" />
    <SettingCardSkeleton fields={1} />
    <SettingCardSkeleton fields={2} />
  </>
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
