import {
  actionGeneric,
  httpActionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import type {
  ActionBuilder,
  GenericActionCtx,
  GenericMutationCtx,
  GenericQueryCtx,
  MutationBuilder,
  QueryBuilder,
} from "convex/server";
import type {
  DataModel as GeneratedDataModel,
  Id as GeneratedId,
  Doc as GeneratedDoc,
  TableNames as GeneratedTableNames,
} from "./dataModel";

export const query = queryGeneric as QueryBuilder<GeneratedDataModel, "public">;
export const internalQuery = internalQueryGeneric as QueryBuilder<GeneratedDataModel, "internal">;
export const mutation = mutationGeneric as MutationBuilder<GeneratedDataModel, "public">;
export const internalMutation = internalMutationGeneric as MutationBuilder<
  GeneratedDataModel,
  "internal"
>;
export const action = actionGeneric as ActionBuilder<GeneratedDataModel, "public">;
export const internalAction = internalActionGeneric as ActionBuilder<GeneratedDataModel, "internal">;
export const httpAction = httpActionGeneric;

export type DataModel = GeneratedDataModel;
export type TableNames = GeneratedTableNames;
export type Id<TableName extends TableNames = TableNames> = GeneratedId<TableName>;
export type Doc<TableName extends TableNames = TableNames> = GeneratedDoc<TableName>;
export type QueryCtx = GenericQueryCtx<GeneratedDataModel>;
export type MutationCtx = GenericMutationCtx<GeneratedDataModel>;
export type ActionCtx = GenericActionCtx<GeneratedDataModel>;
