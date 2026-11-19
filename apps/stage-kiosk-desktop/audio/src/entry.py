"""Reserve the binary response pipe before importing any model/native library."""
import os
import sys

# Libraries can print from Python, C runtime descriptors or Win32 handles. Keep
# the original stdout pipe private; all ordinary diagnostics belong on stderr.
# Redirect before imports, because provider initialization can write there too.
with os.fdopen(os.dup(sys.stdout.fileno()), "wb") as responses:
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes
        import msvcrt

        # NOTICE: _dup2 changes CRT descriptors; DLLs using GetStdHandle need
        # the process handle redirected as well, before those DLLs are loaded.
        # https://learn.microsoft.com/windows/console/setstdhandle
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.SetStdHandle.argtypes = [wintypes.DWORD, wintypes.HANDLE]
        kernel.SetStdHandle.restype = wintypes.BOOL
        if not kernel.SetStdHandle(-11, msvcrt.get_osfhandle(sys.stdout.fileno())):
            raise ctypes.WinError(ctypes.get_last_error())
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)

    from uma8_frontend.worker import main

    main(responses)
