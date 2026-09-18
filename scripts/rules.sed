# Mechanical TypeSafe -> OpenRouter renames applied to every text file in the
# upstream tree except scripts/, .github/ and the overlay files.
#
# Order matters: the more specific env-var names must run before TYPESAFE_URL,
# and api.typesafe.ai must run before the path rewrite so the two compose into
# https://openrouter.ai/api/alpha/decisions.

# Leave the injected SDK shim alone. `b` branches past every rule below, so the
# block that scripts/sdk_override.py writes survives a second rename pass intact
# -- otherwise the `/v1/systemone` literal inside it would be rewritten and the
# path rewrite would silently become a no-op.
/openrouter-shim:begin/,/openrouter-shim:end/ b

s|TYPESAFE_API_KEY|OPENROUTER_API_KEY|g
s|TYPESAFE_BASE_URL|OPENROUTER_BASE_URL|g
s|TYPESAFE_ENDPOINT|OPENROUTER_ENDPOINT|g
s|TYPESAFE_MODEL|OPENROUTER_MODEL|g
s|TYPESAFE_URL|JEV_URL|g

s|jev-latest|typesafe/jev-1.13|g
s|typesafeAPIKey|openRouterAPIKey|g
s|api\.typesafe\.ai|openrouter.ai|g
s|/v1/systemone|/api/alpha/decisions|g

s|a TypeSafe API key|an OpenRouter API key|g
s|Section("TypeSafe")|Section("OpenRouter")|g
s|TypeSafe System One endpoint|OpenRouter Decisions endpoint|g

# Prose that the rename rules above would otherwise leave inaccurate.
s|The only module that talks to TypeSafe|The only module that talks to Jev|g
