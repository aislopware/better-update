# 9. Channel & Branch Management

| Operation          | Endpoint                  | Body                  | Side Effects                                                |
| ------------------ | ------------------------- | --------------------- | ----------------------------------------------------------- |
| **Create Branch**  | `POST /api/branches`      | `{ projectId, name }` | D1 INSERT branches                                          |
| **Create Channel** | `POST /api/channels`      | `{ projectId, name }` | D1 INSERT channels (branch_id defaults to same-name branch) |
| **Relink Channel** | `PATCH /api/channels/:id` | `{ branchId }`        | D1 UPDATE channels + KV.delete (invalidate cache)           |

## Auto-Creation

On first publish to a branch that doesn't exist:

1. Create branch with the given name
2. Create channel with the same name (linked to the new branch)
3. Proceed with publish

This simplifies the initial setup — `eas update --branch production` just works without pre-creating resources.

## Validation: Same-Project Enforcement

All channel→branch references must be within the same project. The following operations enforce this:

| Operation          | Validation                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------- |
| **Create Channel** | `branch_id` (if specified) must belong to `project_id`                                   |
| **Relink Channel** | New `branch_id` must belong to the channel's `project_id`                                |
| **Create Rollout** | `newBranchId` in rollout config must belong to the channel's `project_id`                |
| **Auto-creation**  | Auto-created branch inherits the project context from the publish request — always valid |

Violation returns `400 Bad Request`. This prevents cross-project data leaks where a channel in project A could serve updates from project B.

The D1 index `idx_channels_branch_project` on `(branch_id, project_id)` supports efficient validation.
