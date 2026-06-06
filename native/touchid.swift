// Touch ID / biometric approval helper.
// Usage: swift touchid.swift "reason string"
// Prints OK and exits 0 on success; FAIL/UNAVAILABLE otherwise.
import Foundation
import LocalAuthentication

let reason = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "approve secret access"
let ctx = LAContext()
ctx.localizedFallbackTitle = ""  // hide password fallback — biometrics only
var err: NSError?

if ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err) {
    let sem = DispatchSemaphore(value: 0)
    var ok = false
    ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { success, _ in
        ok = success
        sem.signal()
    }
    sem.wait()
    print(ok ? "OK" : "FAIL")
    exit(ok ? 0 : 1)
} else {
    print("UNAVAILABLE")
    exit(2)
}
