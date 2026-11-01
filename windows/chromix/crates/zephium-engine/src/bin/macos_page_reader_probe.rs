#[cfg(target_os = "macos")]
fn main() {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    if let Err(error) = zephium_engine::run_macos_page_reader_probe(&arguments) {
        eprintln!("page reader probe failed: {error}");
        std::process::exit(1);
    }
    println!("page reader probe passed");
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("the page reader probe runs only on macOS");
    std::process::exit(2);
}
