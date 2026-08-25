/**
 * Complete schema for the local PoC when AG, AN and Hub share one physical
 * PostgreSQL database.
 *
 * This intentionally composes the complete schema barrel instead of selecting
 * one logical role. The logical AG/AN/Hub database clients still enforce
 * ownership and transport boundaries at the application layer.
 */
export * from "./index";