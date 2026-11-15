/**
 * dsh-notara-menu-compat — host half (empty shell).
 *
 * All logic lives in ./client.js (the client half, loaded via
 * exports["./client"] + dsh.client). The host bundle only needs the module
 * to exist so the bundle loader registers the plugin id.
 */

export const name = "dsh-notara-menu-compat";

export function apply() {
  /* client-only plugin: nothing to do on the host side */
}
