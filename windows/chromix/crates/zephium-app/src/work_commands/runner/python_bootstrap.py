# Broker-owned bootstrap. No project import happens before native confinement.
import ctypes
import json
import os
import sys
import unittest
if sys.platform != "win32":
    import resource


def refuse():
    print("The Python test runtime could not be confined", file=sys.stderr)
    raise SystemExit(125)


try:
    request = json.loads(sys.argv[1])
    if request["platform"] == "macos":
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
        sandbox = ctypes.CDLL("/usr/lib/libsandbox.1.dylib", use_errno=True)
        seal = sandbox.sandbox_init
        seal.argtypes = [ctypes.c_char_p, ctypes.c_uint64, ctypes.POINTER(ctypes.c_char_p)]
        seal.restype = ctypes.c_int
        error = ctypes.c_char_p()
        if seal(request["profile"].encode("utf-8"), 0, ctypes.byref(error)) != 0:
            raise RuntimeError()
    elif request["platform"] != "windows":
        raise RuntimeError()
    # Windows reaches this point only after the native owner has verified its
    # suspended child's LPAC token and assigned the kill-on-close Job.
    os.environ.clear()
    os.environ["HOME"] = request["home"]
    os.environ["USERPROFILE"] = request["home"]
    os.environ["TMPDIR"] = request["temporary"]
    os.environ["TEMP"] = request["temporary"]
    os.environ["TMP"] = request["temporary"]
    sys.path[:] = [request["root"], *request["stdlib"]]
    os.chdir(request["root"])
except BaseException:
    refuse()

# A fixed content-free prefix is consumed privately by the guard. No project
# import or callable runs before native sealing and this optional attestation.
if request.get("guard_ready") is True:
    os.write(1, b"\x00ZEPHIUM-PYTHON-SEALED-V1\x00")

suite = unittest.TestLoader().loadTestsFromNames(request["modules"])
if suite.countTestCases() == 0:
    print("No tests discovered", file=sys.stderr)
    raise SystemExit(2)
result = unittest.TextTestRunner(verbosity=1).run(suite)
raise SystemExit(0 if result.wasSuccessful() else 1)
