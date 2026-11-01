cmake_minimum_required(VERSION 3.21)

cmake_policy(SET CMP0091 NEW)
project(cf_native_ugrep LANGUAGES C CXX)

if(NOT MSVC)
  message(FATAL_ERROR "CodeFusion Windows ugrep must be built with MSVC")
endif()

foreach(source_name UGREP PCRE2 ZLIB BZIP2 ZSTD BROTLI)
  if(NOT DEFINED CF_${source_name}_SOURCE_DIR)
    message(FATAL_ERROR "Missing CF_${source_name}_SOURCE_DIR")
  endif()
endforeach()

if(NOT DEFINED CF_UGREP_OUTPUT_DIR)
  message(FATAL_ERROR "Missing CF_UGREP_OUTPUT_DIR")
endif()

set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)

if(DEFINED CF_BUILD_PATH)
  add_compile_options("/pathmap:${CF_BUILD_PATH}=cf-native-search")
endif()

set(BUILD_STATIC_LIBS ON CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2_8 ON CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2_16 OFF CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2_32 OFF CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2GREP OFF CACHE BOOL "" FORCE)
set(PCRE2_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(PCRE2_SHOW_REPORT OFF CACHE BOOL "" FORCE)
set(PCRE2_STATIC_RUNTIME ON CACHE BOOL "" FORCE)
set(PCRE2_SUPPORT_JIT ON CACHE BOOL "" FORCE)
add_subdirectory("${CF_PCRE2_SOURCE_DIR}" pcre2 EXCLUDE_FROM_ALL)

set(SKIP_INSTALL_ALL ON CACHE BOOL "" FORCE)
add_subdirectory("${CF_ZLIB_SOURCE_DIR}" zlib EXCLUDE_FROM_ALL)

add_library(cf_bzip2 STATIC
  "${CF_BZIP2_SOURCE_DIR}/blocksort.c"
  "${CF_BZIP2_SOURCE_DIR}/huffman.c"
  "${CF_BZIP2_SOURCE_DIR}/crctable.c"
  "${CF_BZIP2_SOURCE_DIR}/randtable.c"
  "${CF_BZIP2_SOURCE_DIR}/compress.c"
  "${CF_BZIP2_SOURCE_DIR}/decompress.c"
  "${CF_BZIP2_SOURCE_DIR}/bzlib.c"
)
target_compile_definitions(cf_bzip2 PRIVATE _CRT_SECURE_NO_WARNINGS)
target_include_directories(cf_bzip2 PUBLIC "${CF_BZIP2_SOURCE_DIR}")

set(ZSTD_BUILD_CONTRIB OFF CACHE BOOL "" FORCE)
set(ZSTD_BUILD_PROGRAMS OFF CACHE BOOL "" FORCE)
set(ZSTD_BUILD_SHARED OFF CACHE BOOL "" FORCE)
set(ZSTD_BUILD_STATIC ON CACHE BOOL "" FORCE)
set(ZSTD_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(ZSTD_USE_STATIC_RUNTIME ON CACHE BOOL "" FORCE)
add_subdirectory("${CF_ZSTD_SOURCE_DIR}/build/cmake" zstd EXCLUDE_FROM_ALL)

set(BROTLI_BUNDLED_MODE ON CACHE BOOL "" FORCE)
add_subdirectory("${CF_BROTLI_SOURCE_DIR}" brotli EXCLUDE_FROM_ALL)

set(CF_VIIZ_SOURCE_DIR "${CF_UGREP_SOURCE_DIR}/lzma/C")
add_library(cf_viiz STATIC
  "${CF_VIIZ_SOURCE_DIR}/viizip.c"
  "${CF_VIIZ_SOURCE_DIR}/7zAlloc.c"
  "${CF_VIIZ_SOURCE_DIR}/7zArcIn.c"
  "${CF_VIIZ_SOURCE_DIR}/7zBuf.c"
  "${CF_VIIZ_SOURCE_DIR}/7zBuf2.c"
  "${CF_VIIZ_SOURCE_DIR}/7zCrc.c"
  "${CF_VIIZ_SOURCE_DIR}/7zCrcOpt.c"
  "${CF_VIIZ_SOURCE_DIR}/7zDec.c"
  "${CF_VIIZ_SOURCE_DIR}/7zFile.c"
  "${CF_VIIZ_SOURCE_DIR}/7zStream.c"
  "${CF_VIIZ_SOURCE_DIR}/Bcj2.c"
  "${CF_VIIZ_SOURCE_DIR}/Bra.c"
  "${CF_VIIZ_SOURCE_DIR}/Bra86.c"
  "${CF_VIIZ_SOURCE_DIR}/BraIA64.c"
  "${CF_VIIZ_SOURCE_DIR}/CpuArch.c"
  "${CF_VIIZ_SOURCE_DIR}/Delta.c"
  "${CF_VIIZ_SOURCE_DIR}/Lzma2Dec.c"
  "${CF_VIIZ_SOURCE_DIR}/LzmaDec.c"
  "${CF_VIIZ_SOURCE_DIR}/Ppmd7.c"
  "${CF_VIIZ_SOURCE_DIR}/Ppmd7Dec.c"
)
target_compile_definitions(cf_viiz PRIVATE
  Z7_PPMD_SUPPORT
  Z7_EXTRACT_ONLY
  NDEBUG
  _CRT_SECURE_NO_WARNINGS
)
target_include_directories(cf_viiz PUBLIC "${CF_VIIZ_SOURCE_DIR}")

set(CF_REFLEX_SOURCES
  "${CF_UGREP_SOURCE_DIR}/lib/block_scripts.cpp"
  "${CF_UGREP_SOURCE_DIR}/lib/composer.cpp"
  "${CF_UGREP_SOURCE_DIR}/lib/convert.cpp"
  "${CF_UGREP_SOURCE_DIR}/lib/debug.cpp"
  "${CF_UGREP_SOURCE_DIR}/lib/error.cpp"
  "${CF_UGREP_SOURCE_DIR}/lib/input.cpp"
  "${CF_UGREP_SOURCE_DIR}/lib/language_scripts.cpp"
  "${CF_UGREP_SOURCE_DIR}/lib/letter_case.cpp"
  "${CF_UGREP_SOURCE_DIR}/lib/letter_scripts.cpp"
  "${CF_UGREP_SOURCE_DIR}/lib/matcher.cpp"
  "${CF_UGREP_SOURCE_DIR}/lib/pattern.cpp"
  "${CF_UGREP_SOURCE_DIR}/lib/posix.cpp"
  "${CF_UGREP_SOURCE_DIR}/lib/simd.cpp"
  "${CF_UGREP_SOURCE_DIR}/lib/unicode.cpp"
  "${CF_UGREP_SOURCE_DIR}/lib/utf8.cpp"
)

add_library(cf_reflex STATIC ${CF_REFLEX_SOURCES})
target_compile_definitions(cf_reflex PRIVATE WITH_NO_CODEGEN)

add_executable(ugrep
  "${CF_UGREP_SOURCE_DIR}/src/ugrep.cpp"
  "${CF_UGREP_SOURCE_DIR}/src/cnf.cpp"
  "${CF_UGREP_SOURCE_DIR}/src/glob.cpp"
  "${CF_UGREP_SOURCE_DIR}/src/output.cpp"
  "${CF_UGREP_SOURCE_DIR}/src/query.cpp"
  "${CF_UGREP_SOURCE_DIR}/src/screen.cpp"
  "${CF_UGREP_SOURCE_DIR}/src/stats.cpp"
  "${CF_UGREP_SOURCE_DIR}/src/vkey.cpp"
  "${CF_UGREP_SOURCE_DIR}/src/zopen.c"
)

add_library(cf_ugrep_contract INTERFACE)
target_compile_definitions(cf_ugrep_contract INTERFACE
  HAVE_LIBBROTLI
  HAVE_LIBBZ2
  HAVE_LIBZ
  HAVE_LIBZSTD
  HAVE_PCRE2
  NDEBUG
  PCRE2_STATIC
  WITH_COLOR
  WITH_NO_INDENT
  _CONSOLE
  _CRT_NONSTDC_NO_WARNINGS
  _CRT_SECURE_NO_WARNINGS
)
if(CMAKE_GENERATOR_PLATFORM STREQUAL "ARM64")
  target_compile_definitions(cf_ugrep_contract INTERFACE HAVE_NEON)
else()
  target_compile_definitions(cf_ugrep_contract INTERFACE HAVE_SSE2)
endif()
target_compile_features(cf_ugrep_contract INTERFACE cxx_std_17)
target_compile_options(cf_ugrep_contract INTERFACE
  /utf-8
  $<$<COMPILE_LANGUAGE:CXX>:/EHsc>
)
target_include_directories(cf_ugrep_contract INTERFACE
  "${CF_UGREP_SOURCE_DIR}/include"
  "${CF_UGREP_SOURCE_DIR}/src"
  "${CF_VIIZ_SOURCE_DIR}"
)

target_link_libraries(cf_reflex PRIVATE cf_ugrep_contract pcre2-8-static)
target_link_libraries(ugrep PRIVATE
  cf_ugrep_contract
  cf_reflex
  cf_viiz
  pcre2-8-static
  zlibstatic
  cf_bzip2
  libzstd_static
  brotlienc
  brotlidec
  brotlicommon
)
target_link_options(ugrep PRIVATE /Brepro)
set_target_properties(ugrep PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CF_UGREP_OUTPUT_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CF_UGREP_OUTPUT_DIR}"
)
