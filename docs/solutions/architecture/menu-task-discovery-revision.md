---
title: Ingredient queries rejected before Main by a task-dependent discovery schema
date: 2026-11-08
module: order-menu interactive service
problem_type: runtime-error
tags: [kiosk, eventa, iframe, tool-discovery, stale-tools]
---

# Failure and cause

Recorded ingredient queries completed `kiosk_agent_task/BEGIN`, then failed
`kiosk_conversation_context` before any Main round. The old recording omitted the
transport exception. Fresh and post-recommendation direct-runtime tests passed.

A real iframe reproduces this for 我想吃豬肉, 我要吃魚 and 有虱目魚嗎.
Discovery initially omitted `menu_confirm_item.originalRecipe`. BEGIN changed
`agentTask.transcript`; the per-turn preparation predicate then exposed that
property. The next execution recomputed a different descriptor fingerprint and
incremented `toolsRevision`. The Host still held its original discovery revision,
so context execution failed with STALE_TOOLS before its snapshot was built.

## Resolution and invariant

Keep the optional property in stable discovery. Runtime confirmation still
requires a current task, permitted tool, matching revisions and a preparation
request before accepting `originalRecipe:true`. Read-only tasks cannot confirm
purchases. Per-turn authority is separate from service capability discovery.
Do not ignore revision mismatches, auto-retry writes, or replace this guard with
food-name matching. Genuine capability changes still invalidate stale discovery.

## Verification and limits

Three Chromium iframe tests failed before the fix. Afterward the three queries
and the entire 21-case transport suite pass in Firefox, including origin,
operation-correlation and lost-receipt protections. Existing fuzzy-name and
unsupported-preparation tests verify that the optional property does not grant
authority. No model, ASR or production order is needed to reproduce this fault.

Additional generalization uses every declared ingredient alias (11 ingredient
classes/14 aliases), positive/exclusion wording and seven mixed, preparation,
unknown-product or browsing utterances:35 utterances in both read-only and
mutable task modes,70 task flows. Each chain reuses the original descriptor
across BEGIN/context/END/context without rediscovery. All pass in Firefox;
read-only adds are rejected and carts stay empty. This verifies transport and
permission invariants, not semantic interpretation of those requests by a model.

The old field exceptions were not retained, and no new post-deployment field
query was recorded during investigation. This is a reproduced cause consistent
with that failure stage; Windows hardware acceptance remains separate.
