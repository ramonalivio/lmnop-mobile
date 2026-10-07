cmake_minimum_required(VERSION 3.22.1)
project(appmodules LANGUAGES C CXX)
# Preserve React Native's registration source and autolinked components.
add_subdirectory("${REACT_ANDROID_DIR}/cmake-utils/default-app-setup" react-native-app)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
