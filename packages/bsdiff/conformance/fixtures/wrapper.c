/*
 * Thin CLI entrypoint for expo-updates' vendored bspatch.c.
 *
 * The vendored bspatch.c (this directory) exposes `bspatch_main(argc, argv)`
 * and intentionally ships NO `main()` — expo links it into the expo-updates
 * native module, not a standalone binary. The conformance harness needs a real
 * executable, so this wrapper supplies the missing `main` and forwards argv
 * verbatim:
 *
 *     bspatch <oldfile> <newfile> <patchfile>
 *
 * Keep this file dead-simple: it is part of the ship gate's trusted base. It
 * must NOT alter argv, the exit code, or any patch logic — all behaviour under
 * test lives in the unmodified bspatch.c next to it.
 */

int bspatch_main(int argc, char *argv[]);

int main(int argc, char *argv[]) {
  return bspatch_main(argc, argv);
}
