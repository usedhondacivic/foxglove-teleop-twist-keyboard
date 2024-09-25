import { ExtensionContext } from "@foxglove/extension";

import { initTeleopTwistPanel } from "./TeleopTwistPanel";

export function activate(extensionContext: ExtensionContext): void {
  extensionContext.registerPanel({ name: "Teleop Twist", initPanel: initTeleopTwistPanel });
}
