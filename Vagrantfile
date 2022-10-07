Vagrant.configure("2") do |config|
  config.vm.box = "bento/ubuntu-22.04"

  config.vm.synced_folder "vagrant/bin/", "/host/bin",
        mount_options: ["dmode=775,fmode=777"]

  config.vm.provider "virtualbox" do |v|
    v.memory = 2048
  end

  config.ssh.forward_agent = true

  config.vm.provision "shell",
            path: "https://raw.githubusercontent.com/hamptonsmith/pelton2/main/provision-vagrant.sh"
end
