source "https://rubygems.org"

# Fastlane drives the iOS release pipeline (archive + TestFlight upload).
# It only runs on macOS — see fastlane/README.md.
gem "fastlane", "~> 2.227"

plugins_path = File.join(File.dirname(__FILE__), "fastlane", "Pluginfile")
eval_gemfile(plugins_path) if File.exist?(plugins_path)
